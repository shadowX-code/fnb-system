-- Backstop the source-check advisory lock and server eligibility guard.
-- Historical cancelled POs remain intact and do not block a new draft.
create unique index if not exists inventory_purchase_orders_active_source_supplier_unique
  on public.inventory_purchase_orders(source_stock_check_id,supplier_id)
  where source_type='stock_check' and status<>'cancelled';
