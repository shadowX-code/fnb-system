-- Factory Customers and dispatch workflow refinement.
-- Adds customer master data, customer linkage on dispatches, and DB-side DYYMMDD-01 dispatch creation.

create table if not exists public.factory_customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text unique,
  customer_name text not null,
  customer_type text,
  contact_person text,
  phone text,
  email text,
  address text,
  status text not null default 'active',
  remarks text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists factory_customers_lower_code_key
on public.factory_customers (lower(customer_code))
where customer_code is not null and customer_code <> '';

create index if not exists factory_customers_status_idx
on public.factory_customers(status);

alter table public.factory_finished_good_dispatches
  add column if not exists customer_id uuid references public.factory_customers(id) on delete set null;

create index if not exists factory_finished_good_dispatches_customer_id_idx
on public.factory_finished_good_dispatches(customer_id);

insert into public.permissions (code, module, description)
values
  ('factory_customers.view', 'Factory Customers', 'View Factory customer master data.'),
  ('factory_customers.create', 'Factory Customers', 'Create Factory customer master data.'),
  ('factory_customers.edit', 'Factory Customers', 'Edit Factory customer master data.'),
  ('factory_customers.delete', 'Factory Customers', 'Archive Factory customer master data.'),
  ('factory_customers.export', 'Factory Customers', 'Export Factory customer master data.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

grant select, insert, update, delete on public.factory_customers to authenticated;
alter table public.factory_customers enable row level security;

drop policy if exists "factory customers view" on public.factory_customers;
create policy "factory customers view" on public.factory_customers for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.create')
  or public.current_user_has_permission('factory_customers.view')
  or public.current_user_has_permission('factory_customers.create')
  or public.current_user_has_permission('factory_customers.edit')
  or public.current_user_has_permission('factory_customers.delete')
  or public.current_user_has_permission('factory_customers.export')
);

drop policy if exists "factory customers insert" on public.factory_customers;
create policy "factory customers insert" on public.factory_customers for insert to authenticated
with check (public.current_user_has_permission('factory_customers.create'));

drop policy if exists "factory customers update" on public.factory_customers;
create policy "factory customers update" on public.factory_customers for update to authenticated
using (
  public.current_user_has_permission('factory_customers.edit')
  or public.current_user_has_permission('factory_customers.delete')
)
with check (
  public.current_user_has_permission('factory_customers.edit')
  or public.current_user_has_permission('factory_customers.delete')
);

create or replace function public.factory_create_finished_good_dispatch(
  p_customer_id uuid,
  p_reference_no text,
  p_dispatch_date date,
  p_remarks text,
  p_created_by uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.factory_customers%rowtype;
  v_dispatch_id uuid;
  v_dispatch_no text;
  v_dispatch_date date := coalesce(p_dispatch_date, current_date);
  v_prefix text := 'D' || to_char(coalesce(p_dispatch_date, current_date), 'YYMMDD');
  v_next integer;
  v_item jsonb;
  v_finished_good_id uuid;
  v_quantity numeric;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.create') then
    raise exception 'Missing permission: factory_finished_goods_dispatch.create';
  end if;

  if p_customer_id is null then
    raise exception 'Customer is required.';
  end if;

  select *
  into v_customer
  from public.factory_customers customer
  where customer.id = p_customer_id
    and customer.status = 'active';

  if v_customer.id is null then
    raise exception 'Active customer not found.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Dispatch must have at least one item.';
  end if;

  perform pg_advisory_xact_lock(hashtext('factory_dispatch_' || v_prefix));

  select coalesce(max(nullif(regexp_replace(d.dispatch_no, '^' || v_prefix || '-', ''), '')::integer), 0) + 1
  into v_next
  from public.factory_finished_good_dispatches d
  where d.dispatch_no ~ ('^' || v_prefix || '-[0-9]+$');

  v_dispatch_no := v_prefix || '-' || lpad(v_next::text, 2, '0');

  insert into public.factory_finished_good_dispatches (
    dispatch_no,
    dispatch_date,
    customer_id,
    customer_name,
    reference_no,
    status,
    remarks,
    created_by,
    created_at,
    updated_at
  )
  values (
    v_dispatch_no,
    v_dispatch_date,
    v_customer.id,
    v_customer.customer_name,
    coalesce(p_reference_no, ''),
    'draft',
    coalesce(p_remarks, ''),
    p_created_by,
    now(),
    now()
  )
  returning id into v_dispatch_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_finished_good_id := nullif(v_item->>'finished_good_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    if v_finished_good_id is null or v_quantity <= 0 then
      raise exception 'Every dispatch item needs a Packaging SKU and quantity greater than 0.';
    end if;

    insert into public.factory_finished_good_dispatch_items (
      dispatch_id,
      finished_good_id,
      quantity,
      batch_no,
      remarks,
      created_at
    )
    values (
      v_dispatch_id,
      v_finished_good_id,
      v_quantity,
      coalesce(v_item->>'batch_no', ''),
      coalesce(v_item->>'remarks', ''),
      now()
    );
  end loop;

  return v_dispatch_id;
end;
$$;

grant execute on function public.factory_create_finished_good_dispatch(uuid, text, date, text, uuid, jsonb) to authenticated;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
