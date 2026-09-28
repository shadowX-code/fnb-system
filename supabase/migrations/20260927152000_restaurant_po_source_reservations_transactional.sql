-- Replacement for the unledgered 20260927151034 migration on runners that execute
-- statements individually. Keep the capture and trigger installation atomic.
begin;

-- Forward replacement for the source/supplier index. Historical duplicates are
-- facts, not candidates for cleanup. No business/evidence row is rewritten.
-- Release manifests for baselines where 20260924003727 was never applied must
-- omit that incompatible index migration and apply this replacement instead.
create schema if not exists inventory_authority;
revoke all on schema inventory_authority from public, anon, authenticated;

-- Prevent writes between the historical capture and installation of the guard.
lock table public.inventory_purchase_orders in share row exclusive mode;

create table inventory_authority.purchase_order_source_reservations (
  source_stock_check_id uuid not null,
  supplier_id uuid not null,
  active_po_ids uuid[] not null,
  historical_po_ids uuid[] not null default '{}',
  reserved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_stock_check_id, supplier_id),
  check (array_position(active_po_ids, null) is null),
  check (array_position(historical_po_ids, null) is null)
);
alter table inventory_authority.purchase_order_source_reservations enable row level security;
revoke all on inventory_authority.purchase_order_source_reservations from public, anon, authenticated, service_role;

insert into inventory_authority.purchase_order_source_reservations
  (source_stock_check_id,supplier_id,active_po_ids,historical_po_ids)
select source_stock_check_id,supplier_id,array_agg(id order by id),array_agg(id order by id)
from public.inventory_purchase_orders
where source_type='stock_check' and status<>'cancelled'
  and source_stock_check_id is not null and supplier_id is not null
group by source_stock_check_id,supplier_id;

-- AFTER-row enforcement also protects privileged writers. Unique-key UPSERT
-- resolves concurrent inserts against the committed reservation row, rather
-- than relying on an MVCC-visible SELECT or client-provided creation timestamp.
create function inventory_authority.reserve_purchase_order_source()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old_active boolean := false;
  v_new_active boolean := false;
  v_claim uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_active := old.source_type='stock_check' and old.status<>'cancelled';
  end if;
  if tg_op <> 'DELETE' then
    v_new_active := new.source_type='stock_check' and new.status<>'cancelled';
  end if;
  if v_new_active and (new.source_stock_check_id is null or new.supplier_id is null) then
    raise exception 'Source stock check and supplier are required.';
  end if;
  -- Lifecycle updates of existing legacy siblings are not new reservations.
  if tg_op='UPDATE' and v_old_active and v_new_active
    and old.id=new.id and old.source_stock_check_id=new.source_stock_check_id
    and old.supplier_id=new.supplier_id then
    return new;
  end if;
  if v_old_active then
    -- Remove this PO only. Other historical siblings (including completed)
    -- keep the key occupied. Keep the row and original historical membership.
    update inventory_authority.purchase_order_source_reservations
    set active_po_ids=array_remove(active_po_ids,old.id),updated_at=now()
    where source_stock_check_id=old.source_stock_check_id and supplier_id=old.supplier_id;
  end if;
  if v_new_active then
    insert into inventory_authority.purchase_order_source_reservations as reservation
      (source_stock_check_id,supplier_id,active_po_ids)
    values (new.source_stock_check_id,new.supplier_id,array[new.id])
    on conflict (source_stock_check_id,supplier_id) do update
      set active_po_ids=excluded.active_po_ids,updated_at=now()
      where cardinality(reservation.active_po_ids)=0
    returning source_stock_check_id into v_claim;
    if v_claim is null then
      raise exception using errcode='23505',
        message='A purchase order already exists for this stock check and supplier.';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function inventory_authority.reserve_purchase_order_source() from public, anon, authenticated, service_role;

create trigger inventory_purchase_order_source_reservation
after insert or update or delete on public.inventory_purchase_orders
for each row execute function inventory_authority.reserve_purchase_order_source();

-- Staging may already have the old index. Replace its backstop atomically;
-- Production duplicate history never has to pass that global index build.
drop index if exists public.inventory_purchase_orders_active_source_supplier_unique;

comment on table inventory_authority.purchase_order_source_reservations is
  'Private prospective PO uniqueness; captured legacy membership is preserved, not adjudicated. Cancelled siblings release only their own membership.';

commit;
