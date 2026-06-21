-- Factory raw material manual fallback cost.
-- Receiving costs remain the preferred cost source; these fields are used only when no receiving cost exists.

alter table public.factory_raw_materials
  add column if not exists manual_unit_cost numeric,
  add column if not exists manual_cost_uom text;
