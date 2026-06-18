-- Factory Finished Goods Dispatch.
-- Adds outbound finished goods dispatch documents and transaction-safe completion stock-out.

create table if not exists public.factory_finished_good_dispatches (
  id uuid primary key default gen_random_uuid(),
  dispatch_no text unique not null,
  dispatch_date date not null default current_date,
  customer_name text not null,
  reference_no text,
  status text not null default 'draft',
  remarks text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.factory_finished_good_dispatch_items (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.factory_finished_good_dispatches(id) on delete cascade,
  finished_good_id uuid not null references public.factory_finished_goods(id),
  quantity numeric not null,
  batch_no text,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists factory_finished_good_dispatches_date_idx
on public.factory_finished_good_dispatches(dispatch_date);

create index if not exists factory_finished_good_dispatches_status_idx
on public.factory_finished_good_dispatches(status);

create index if not exists factory_finished_good_dispatch_items_dispatch_id_idx
on public.factory_finished_good_dispatch_items(dispatch_id);

create index if not exists factory_finished_good_dispatch_items_finished_good_id_idx
on public.factory_finished_good_dispatch_items(finished_good_id);

insert into public.permissions (code, module, description)
values
  ('factory_finished_goods_dispatch.view', 'Factory Finished Goods Dispatch', 'View Factory finished goods dispatch documents.'),
  ('factory_finished_goods_dispatch.create', 'Factory Finished Goods Dispatch', 'Create Factory finished goods dispatch documents.'),
  ('factory_finished_goods_dispatch.edit', 'Factory Finished Goods Dispatch', 'Edit Factory finished goods dispatch drafts.'),
  ('factory_finished_goods_dispatch.delete', 'Factory Finished Goods Dispatch', 'Cancel Factory finished goods dispatch documents.'),
  ('factory_finished_goods_dispatch.complete', 'Factory Finished Goods Dispatch', 'Complete Factory finished goods dispatch and stock-out.'),
  ('factory_finished_goods_dispatch.export', 'Factory Finished Goods Dispatch', 'Export Factory finished goods dispatch documents.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

grant select, insert, update, delete on public.factory_finished_good_dispatches to authenticated;
grant select, insert, update, delete on public.factory_finished_good_dispatch_items to authenticated;

alter table public.factory_finished_good_dispatches enable row level security;
alter table public.factory_finished_good_dispatch_items enable row level security;

drop policy if exists "factory finished goods dispatch view" on public.factory_finished_good_dispatches;
create policy "factory finished goods dispatch view" on public.factory_finished_good_dispatches for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.create')
  or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
);

drop policy if exists "factory finished goods dispatch insert" on public.factory_finished_good_dispatches;
create policy "factory finished goods dispatch insert" on public.factory_finished_good_dispatches for insert to authenticated
with check (
  public.current_user_has_permission('factory_finished_goods_dispatch.create')
);

drop policy if exists "factory finished goods dispatch update" on public.factory_finished_good_dispatches;
create policy "factory finished goods dispatch update" on public.factory_finished_good_dispatches for update to authenticated
using (
  status = 'draft'
  and (
    public.current_user_has_permission('factory_finished_goods_dispatch.edit')
    or public.current_user_has_permission('factory_finished_goods_dispatch.delete')
    or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
  )
)
with check (
  status in ('draft', 'cancelled')
  and (
    public.current_user_has_permission('factory_finished_goods_dispatch.edit')
    or public.current_user_has_permission('factory_finished_goods_dispatch.delete')
  )
);

drop policy if exists "factory finished goods dispatch items view" on public.factory_finished_good_dispatch_items;
create policy "factory finished goods dispatch items view" on public.factory_finished_good_dispatch_items for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.create')
  or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
);

drop policy if exists "factory finished goods dispatch items manage" on public.factory_finished_good_dispatch_items;
drop policy if exists "factory finished goods dispatch items insert" on public.factory_finished_good_dispatch_items;
create policy "factory finished goods dispatch items insert" on public.factory_finished_good_dispatch_items for insert to authenticated
with check (
  (
    public.current_user_has_permission('factory_finished_goods_dispatch.create')
    or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  )
  and exists (
    select 1
    from public.factory_finished_good_dispatches dispatch
    where dispatch.id = dispatch_id
      and dispatch.status = 'draft'
  )
);

drop policy if exists "factory finished goods dispatch items update" on public.factory_finished_good_dispatch_items;
create policy "factory finished goods dispatch items update" on public.factory_finished_good_dispatch_items for update to authenticated
using (
  public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  and exists (
    select 1
    from public.factory_finished_good_dispatches dispatch
    where dispatch.id = dispatch_id
      and dispatch.status = 'draft'
  )
)
with check (
  public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  and exists (
    select 1
    from public.factory_finished_good_dispatches dispatch
    where dispatch.id = dispatch_id
      and dispatch.status = 'draft'
  )
);

drop policy if exists "factory finished goods dispatch items delete" on public.factory_finished_good_dispatch_items;
create policy "factory finished goods dispatch items delete" on public.factory_finished_good_dispatch_items for delete to authenticated
using (
  public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  and exists (
    select 1
    from public.factory_finished_good_dispatches dispatch
    where dispatch.id = dispatch_id
      and dispatch.status = 'draft'
  )
);

create or replace function public.factory_complete_finished_good_dispatch(p_dispatch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.factory_finished_good_dispatches%rowtype;
  v_item record;
  v_finished_good public.factory_finished_goods%rowtype;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.complete') then
    raise exception 'Missing permission: factory_finished_goods_dispatch.complete';
  end if;

  select *
  into v_dispatch
  from public.factory_finished_good_dispatches d
  where d.id = p_dispatch_id
  for update;

  if v_dispatch.id is null then
    raise exception 'Dispatch not found.';
  end if;

  if v_dispatch.status <> 'draft' then
    raise exception 'Only draft dispatches can be completed.';
  end if;

  if not exists (
    select 1
    from public.factory_finished_good_dispatch_items item
    where item.dispatch_id = p_dispatch_id
  ) then
    raise exception 'Dispatch must have at least one item.';
  end if;

  for v_item in
    select item.*
    from public.factory_finished_good_dispatch_items item
    where item.dispatch_id = p_dispatch_id
    order by item.created_at, item.id
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'Dispatch item quantity must be greater than 0.';
    end if;

    select *
    into v_finished_good
    from public.factory_finished_goods fg
    where fg.id = v_item.finished_good_id
    for update;

    if v_finished_good.id is null then
      raise exception 'Packaging SKU not found.';
    end if;

    if coalesce(v_finished_good.current_balance, 0) < v_item.quantity then
      raise exception 'Insufficient finished goods balance for %. Available %, requested %.',
        coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU'),
        coalesce(v_finished_good.current_balance, 0),
        v_item.quantity;
    end if;

    update public.factory_finished_goods fg
    set current_balance = coalesce(fg.current_balance, 0) - v_item.quantity,
        updated_at = now()
    where fg.id = v_item.finished_good_id;

    insert into public.factory_product_stock_movements (
      finished_good_id,
      product_name,
      movement_type,
      quantity,
      uom,
      reference_type,
      reference_id,
      reference_no,
      movement_date,
      notes,
      created_by
    )
    values (
      v_item.finished_good_id,
      v_finished_good.product_name,
      'Dispatch Out',
      -v_item.quantity,
      coalesce(v_finished_good.packaging_type, 'Pack'),
      'finished_goods_dispatch',
      v_dispatch.id,
      v_dispatch.dispatch_no,
      v_dispatch.dispatch_date,
      'Finished goods Packaging SKU dispatched to ' || v_dispatch.customer_name || '.',
      v_dispatch.created_by
    );
  end loop;

  update public.factory_finished_good_dispatches d
  set status = 'completed',
      completed_at = now(),
      updated_at = now()
  where d.id = p_dispatch_id;

  return p_dispatch_id;
end;
$$;

grant execute on function public.factory_complete_finished_good_dispatch(uuid) to authenticated;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
