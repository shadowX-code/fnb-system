-- Keep legal-employer/month scans selective and rule out paid "non-payable" decisions.
create index payroll_time_entity_date_idx on public.payroll_payable_time_versions
  ((evidence->>'legal_entity_id'),work_date desc);
create index payroll_run_time_version_idx on public.payroll_run_time_snapshots(time_version_id);
alter table public.payroll_payable_time_versions
  add constraint payroll_non_payable_minutes_check check
    (classification<>'non_payable' or (approved_minutes is null or approved_minutes=0));
