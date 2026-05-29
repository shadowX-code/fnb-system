-- Stock Check persistence fields for scheduled and audit workflows.

alter table public.inventory_stock_checks
  add column if not exists check_name text,
  add column if not exists shift text,
  add column if not exists check_date date;

alter table public.inventory_stock_check_items
  add column if not exists category_id uuid references public.inventory_categories(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.inventory_stock_check_items
  alter column par_level_quantity drop not null,
  alter column actual_count_quantity drop not null,
  alter column variance drop not null;

create index if not exists idx_inventory_stock_checks_group_date_shift
  on public.inventory_stock_checks(group_id, check_date, shift);

create index if not exists idx_inventory_stock_checks_outlet_date
  on public.inventory_stock_checks(outlet_id, check_date);

create index if not exists idx_inventory_stock_checks_type_status
  on public.inventory_stock_checks(stock_check_type, status);

create index if not exists idx_inventory_stock_check_items_check
  on public.inventory_stock_check_items(stock_check_id);
