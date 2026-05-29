-- Track the employee who submitted scheduled and audit stock checks.

alter table public.inventory_stock_checks
  add column if not exists submitted_by uuid references public.employees(id) on delete set null;

create index if not exists idx_inventory_stock_checks_submitted_by
  on public.inventory_stock_checks(submitted_by);
