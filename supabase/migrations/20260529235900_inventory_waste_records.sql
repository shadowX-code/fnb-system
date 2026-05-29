create table if not exists public.inventory_waste_records (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.outlets(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  waste_type text not null,
  quantity numeric(14,3) not null,
  unit text,
  waste_date date not null,
  notes text,
  photo_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_waste_records_outlet_idx on public.inventory_waste_records (outlet_id);
create index if not exists inventory_waste_records_item_idx on public.inventory_waste_records (inventory_item_id);
create index if not exists inventory_waste_records_type_idx on public.inventory_waste_records (waste_type);
create index if not exists inventory_waste_records_date_idx on public.inventory_waste_records (waste_date desc);

grant select, insert, update, delete on table public.inventory_waste_records to authenticated;
revoke all on table public.inventory_waste_records from anon;

alter table public.inventory_waste_records enable row level security;

drop policy if exists "inventory waste scoped select" on public.inventory_waste_records;
create policy "inventory waste scoped select"
on public.inventory_waste_records for select to authenticated
using (
  (
    public.current_user_has_permission('inventory_waste.view')
    or public.current_user_has_permission('inventory_waste.create')
    or public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory waste scoped insert" on public.inventory_waste_records;
create policy "inventory waste scoped insert"
on public.inventory_waste_records for insert to authenticated
with check (
  (
    public.current_user_has_permission('inventory_waste.create')
    or public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory waste scoped update" on public.inventory_waste_records;
create policy "inventory waste scoped update"
on public.inventory_waste_records for update to authenticated
using (
  (
    public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory waste scoped delete" on public.inventory_waste_records;
create policy "inventory waste scoped delete"
on public.inventory_waste_records for delete to authenticated
using (
  (
    public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory movements waste writers" on public.inventory_movements;
create policy "inventory movements waste writers"
on public.inventory_movements for insert to authenticated
with check (
  reference_type = 'waste'
  and (
    public.current_user_has_permission('inventory_waste.create')
    or public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);
