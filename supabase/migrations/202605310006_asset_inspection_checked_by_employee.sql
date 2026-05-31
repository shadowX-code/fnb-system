alter table public.asset_inspections
add column if not exists checked_by_employee_id uuid references public.employees(id);

create index if not exists asset_inspections_checked_by_employee_idx
on public.asset_inspections (checked_by_employee_id);
