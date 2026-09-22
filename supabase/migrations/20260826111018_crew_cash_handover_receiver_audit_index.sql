-- Receiver history is queried by outlet in reverse change order.
create index if not exists crew_cash_handover_receiver_config_audit_outlet_changed_idx
on public.crew_cash_handover_receiver_config_audit(outlet_id, changed_at desc);
