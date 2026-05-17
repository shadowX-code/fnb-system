-- Production QA Fix
-- Make Sales Input, Purchase Input, and Outlets persistence source-of-truth
-- compatible with the current feature-level RBAC registry.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Outlets
-- ---------------------------------------------------------------------------
create table if not exists public.outlets (
  id uuid primary key default gen_random_uuid()
);

alter table public.outlets
  add column if not exists name text,
  add column if not exists code text,
  add column if not exists location text,
  add column if not exists address text,
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.outlets
set
  status = case when is_active then 'active' else 'inactive' end,
  location = coalesce(location, address),
  address = coalesce(address, location);

create unique index if not exists outlets_code_unique_idx
  on public.outlets (code)
  where code is not null;

-- ---------------------------------------------------------------------------
-- Master table guards required by transaction foreign keys
-- ---------------------------------------------------------------------------
create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid()
);

alter table public.sales_channels
  add column if not exists name text,
  add column if not exists type text not null default 'channel',
  add column if not exists sort_order integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.purchase_categories (
  id uuid primary key default gen_random_uuid()
);

alter table public.purchase_categories
  add column if not exists name text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid()
);

alter table public.suppliers
  add column if not exists name text,
  add column if not exists category text,
  add column if not exists default_category_id uuid references public.purchase_categories(id) on delete set null,
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Sales Records
-- ---------------------------------------------------------------------------
create table if not exists public.sales_records (
  id uuid primary key default gen_random_uuid()
);

alter table public.sales_records
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade,
  add column if not exists year integer,
  add column if not exists month integer,
  add column if not exists channel_id uuid references public.sales_channels(id) on delete set null,
  add column if not exists channel_name text,
  add column if not exists amount numeric(14,2) not null default 0,
  add column if not exists remark text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_records' and column_name = 'period_year'
  ) then
    execute 'update public.sales_records set year = period_year where year is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_records' and column_name = 'period_month'
  ) then
    execute 'update public.sales_records set month = period_month where month is null';
  end if;
end $$;

create index if not exists sales_records_period_idx
  on public.sales_records (outlet_id, year, month);

create index if not exists sales_records_channel_period_idx
  on public.sales_records (outlet_id, year, month, channel_name);

-- ---------------------------------------------------------------------------
-- Purchase Records guards
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_records (
  id uuid primary key default gen_random_uuid()
);

alter table public.purchase_records
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade,
  add column if not exists year integer,
  add column if not exists month integer,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete restrict,
  add column if not exists category_id uuid references public.purchase_categories(id) on delete restrict,
  add column if not exists amount numeric(14,2) not null default 0,
  add column if not exists remark text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists purchase_records_period_idx
  on public.purchase_records (outlet_id, year, month);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

revoke all on table public.outlets from anon;
revoke all on table public.sales_records from anon;
revoke all on table public.purchase_records from anon;

grant select, insert, update, delete on table public.outlets to authenticated;
grant select, insert, update, delete on table public.sales_records to authenticated;
grant select, insert, update, delete on table public.purchase_records to authenticated;

alter table public.outlets enable row level security;
alter table public.sales_records enable row level security;
alter table public.purchase_records enable row level security;

-- ---------------------------------------------------------------------------
-- Outlet RLS
-- ---------------------------------------------------------------------------
drop policy if exists "outlet viewers can view outlets" on public.outlets;
create policy "outlet viewers can view outlets"
on public.outlets for select to authenticated
using (public.current_user_has_permission('outlets.view'));

drop policy if exists "outlet creators can insert outlets" on public.outlets;
create policy "outlet creators can insert outlets"
on public.outlets for insert to authenticated
with check (public.current_user_has_permission('outlets.create'));

drop policy if exists "outlet editors can update outlets" on public.outlets;
create policy "outlet editors can update outlets"
on public.outlets for update to authenticated
using (public.current_user_has_permission('outlets.edit'))
with check (public.current_user_has_permission('outlets.edit'));

drop policy if exists "outlet deleters can delete outlets" on public.outlets;
create policy "outlet deleters can delete outlets"
on public.outlets for delete to authenticated
using (public.current_user_has_permission('outlets.delete'));

-- ---------------------------------------------------------------------------
-- Sales RLS
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated users can view sales records" on public.sales_records;
drop policy if exists "sales editors can write sales records" on public.sales_records;
drop policy if exists "sales input and comparison viewers can view sales records" on public.sales_records;
create policy "sales input and comparison viewers can view sales records"
on public.sales_records for select to authenticated
using (
  public.current_user_has_permission('sales_input.view')
  or public.current_user_has_permission('sales_comparison.view')
);

drop policy if exists "sales input creators can insert sales records" on public.sales_records;
create policy "sales input creators can insert sales records"
on public.sales_records for insert to authenticated
with check (public.current_user_has_permission('sales_input.create'));

drop policy if exists "sales input editors can update sales records" on public.sales_records;
create policy "sales input editors can update sales records"
on public.sales_records for update to authenticated
using (public.current_user_has_permission('sales_input.edit'))
with check (public.current_user_has_permission('sales_input.edit'));

drop policy if exists "sales input deleters can delete sales records" on public.sales_records;
create policy "sales input deleters can delete sales records"
on public.sales_records for delete to authenticated
using (public.current_user_has_permission('sales_input.delete'));

-- ---------------------------------------------------------------------------
-- Purchase RLS
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated users can view purchase records" on public.purchase_records;
drop policy if exists "purchase editors can write purchase records" on public.purchase_records;
drop policy if exists "purchase input and comparison viewers can view purchase records" on public.purchase_records;
create policy "purchase input and comparison viewers can view purchase records"
on public.purchase_records for select to authenticated
using (
  public.current_user_has_permission('purchase_input.view')
  or public.current_user_has_permission('purchase_comparison.view')
);

drop policy if exists "purchase input creators can insert purchase records" on public.purchase_records;
create policy "purchase input creators can insert purchase records"
on public.purchase_records for insert to authenticated
with check (public.current_user_has_permission('purchase_input.create'));

drop policy if exists "purchase input editors can update purchase records" on public.purchase_records;
create policy "purchase input editors can update purchase records"
on public.purchase_records for update to authenticated
using (
  public.current_user_has_permission('purchase_input.edit')
  or public.current_user_has_permission('purchase_input.approve')
)
with check (
  public.current_user_has_permission('purchase_input.edit')
  or public.current_user_has_permission('purchase_input.approve')
);

drop policy if exists "purchase input deleters can delete purchase records" on public.purchase_records;
create policy "purchase input deleters can delete purchase records"
on public.purchase_records for delete to authenticated
using (public.current_user_has_permission('purchase_input.delete'));
