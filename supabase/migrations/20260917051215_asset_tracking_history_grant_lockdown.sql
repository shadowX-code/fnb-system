-- Phase 1 follow-up: earlier broad authenticated grants included TRUNCATE and
-- TRIGGER. Restrict ordinary history access to the read projection only.
revoke all on table public.asset_movement_logs from authenticated;
revoke all on table public.asset_inspections from authenticated;
revoke all on table public.asset_inspection_items from authenticated;
revoke all on table public.asset_inspection_evidence from authenticated;
revoke all on table public.asset_maintenance_records from authenticated;

grant select on table public.asset_movement_logs to authenticated;
grant select on table public.asset_inspections to authenticated;
grant select on table public.asset_inspection_items to authenticated;
grant select on table public.asset_inspection_evidence to authenticated;
grant select on table public.asset_maintenance_records to authenticated;

revoke delete, truncate, trigger on table public.asset_items from authenticated;
