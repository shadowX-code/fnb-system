-- Roll back Supplier Directory performance index experiment.
-- Supplier loading architecture remains on the existing straightforward flow.

drop index if exists public.supplier_outlets_supplier_outlet_idx;
drop index if exists public.supplier_outlets_outlet_supplier_idx;
drop index if exists public.purchase_records_supplier_idx;
drop index if exists public.purchase_records_outlet_idx;
drop index if exists public.purchase_records_supplier_outlet_period_idx;
drop index if exists public.purchase_records_period_supplier_idx;
