-- Supplier Directory performance indexes
-- Supports outlet assignment counts, selected-month totals and latest purchase lookups.

create index if not exists supplier_outlets_supplier_outlet_idx
  on public.supplier_outlets (supplier_id, outlet_id);

create index if not exists supplier_outlets_outlet_supplier_idx
  on public.supplier_outlets (outlet_id, supplier_id);

create index if not exists purchase_records_supplier_idx
  on public.purchase_records (supplier_id);

create index if not exists purchase_records_outlet_idx
  on public.purchase_records (outlet_id);

create index if not exists purchase_records_supplier_outlet_period_idx
  on public.purchase_records (supplier_id, outlet_id, year, month);

create index if not exists purchase_records_period_supplier_idx
  on public.purchase_records (year, month, supplier_id);
