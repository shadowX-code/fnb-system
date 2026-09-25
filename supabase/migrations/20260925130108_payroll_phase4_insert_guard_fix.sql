-- An INSERT trigger has no OLD row. Keep the Run-status check inside the
-- UPDATE branch so appending statutory evidence cannot dereference OLD.status.
create or replace function public.payroll_command_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('feedx.payroll_command',true) is distinct from 'yes' then
    raise exception using errcode='42501',message='Payroll records require the canonical command authority.';
  end if;
  if tg_op='DELETE' then
    raise exception using errcode='55000',message='Payroll history cannot be deleted.';
  end if;
  if tg_op='UPDATE' then
    if tg_table_name in
      ('payroll_compensation_versions','payroll_recurring_component_versions',
       'payroll_statutory_profile_versions','payroll_run_profile_snapshots','payroll_events',
       'payroll_payable_time_versions','payroll_run_time_snapshots',
       'payroll_pay_rule_versions','payroll_run_component_adjustments',
       'payroll_run_calculation_versions','payroll_run_calculation_snapshots',
       'payroll_statutory_input_versions','payroll_statutory_schedule_versions',
       'payroll_statutory_schedule_bands','payroll_run_statutory_versions',
       'payroll_run_statutory_snapshots') then
      raise exception using errcode='55000',message='Payroll historical evidence is immutable.';
    end if;
    if tg_table_name='payroll_runs' and old.status in ('finalized','paid') then
      raise exception using errcode='55000',message='Finalized payroll runs are immutable.';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
