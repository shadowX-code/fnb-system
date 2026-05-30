alter table public.inventory_items
  add column if not exists cost numeric(12,4) default 0,
  add column if not exists cost_updated_at timestamptz null,
  add column if not exists cost_updated_by uuid null references public.employees(id) on delete set null;

create index if not exists inventory_items_cost_updated_by_idx
  on public.inventory_items (cost_updated_by);
