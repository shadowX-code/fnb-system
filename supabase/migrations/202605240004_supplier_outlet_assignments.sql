-- Supplier outlet assignments
-- Suppliers are only usable by outlets they are assigned to.

create extension if not exists pgcrypto;

create table if not exists public.supplier_outlets (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (supplier_id, outlet_id)
);

create index if not exists supplier_outlets_supplier_idx on public.supplier_outlets (supplier_id);
create index if not exists supplier_outlets_outlet_idx on public.supplier_outlets (outlet_id);

insert into public.supplier_outlets (supplier_id, outlet_id)
select distinct pr.supplier_id, pr.outlet_id
from public.purchase_records pr
where pr.supplier_id is not null
  and pr.outlet_id is not null
on conflict (supplier_id, outlet_id) do nothing;

grant select, insert, update, delete on table public.supplier_outlets to authenticated;
revoke all on table public.supplier_outlets from anon;
alter table public.supplier_outlets enable row level security;

drop policy if exists "supplier outlet viewers can view assignments" on public.supplier_outlets;
create policy "supplier outlet viewers can view assignments"
on public.supplier_outlets for select to authenticated
using (
  (
    public.current_user_has_permission('suppliers.view')
    or public.current_user_has_permission('purchase_input.view')
    or public.current_user_has_permission('purchase_comparison.view')
    or public.current_user_has_permission('data_import.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "supplier outlet managers can create assignments" on public.supplier_outlets;
create policy "supplier outlet managers can create assignments"
on public.supplier_outlets for insert to authenticated
with check (
  (
    public.current_user_has_permission('suppliers.create')
    or public.current_user_has_permission('suppliers.edit')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "supplier outlet managers can update assignments" on public.supplier_outlets;
create policy "supplier outlet managers can update assignments"
on public.supplier_outlets for update to authenticated
using (
  (
    public.current_user_has_permission('suppliers.edit')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('suppliers.edit')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "supplier outlet managers can delete assignments" on public.supplier_outlets;
create policy "supplier outlet managers can delete assignments"
on public.supplier_outlets for delete to authenticated
using (
  (
    public.current_user_has_permission('suppliers.edit')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);
