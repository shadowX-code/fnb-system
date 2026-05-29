create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.outlets(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  movement_type text not null,
  quantity numeric(14,3) not null,
  unit text,
  reference_type text,
  reference_id uuid,
  reference_no text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.inventory_purchase_orders
  add column if not exists submitted_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists completion_type text,
  add column if not exists completion_reason text,
  add column if not exists unfulfilled_qty numeric(14,3) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.inventory_purchase_order_items
  add column if not exists received_qty numeric(14,3) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists inventory_movements_outlet_idx on public.inventory_movements (outlet_id);
create index if not exists inventory_movements_item_idx on public.inventory_movements (inventory_item_id);
create index if not exists inventory_movements_reference_idx on public.inventory_movements (reference_type, reference_id);
create index if not exists inventory_movements_created_at_idx on public.inventory_movements (created_at desc);

grant select, insert, update, delete on table public.inventory_movements to authenticated;
revoke all on table public.inventory_movements from anon;

alter table public.inventory_movements enable row level security;

drop policy if exists "inventory movements scoped access" on public.inventory_movements;
create policy "inventory movements scoped access"
on public.inventory_movements for all to authenticated
using (
  (
    public.current_user_has_permission('inventory_movements.view')
    or public.current_user_has_permission('inventory_movements.create')
    or public.current_user_has_permission('inventory_orders.receive')
    or public.current_user_has_permission('inventory_orders.complete')
    or public.current_user_has_permission('inventory_orders.edit')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_movements.create')
    or public.current_user_has_permission('inventory_orders.receive')
    or public.current_user_has_permission('inventory_orders.edit')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory purchase receipts scoped access" on public.inventory_purchase_receipts;
create policy "inventory purchase receipts scoped access"
on public.inventory_purchase_receipts for all to authenticated
using (
  (
    public.current_user_has_permission('inventory_orders.view')
    or public.current_user_has_permission('inventory_orders.receive')
    or public.current_user_has_permission('inventory_orders.edit')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_orders.receive')
    or public.current_user_has_permission('inventory_orders.edit')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);
