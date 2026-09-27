-- The Phase 1 foundation runs are immutable. A subsequent effective-dated
-- version must not reinterpret a profile already pinned by a finalized run.
create or replace function public.payroll_effective_version_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if exists(select 1 from public.payroll_run_profile_snapshots s
      join public.payroll_runs r on r.id=s.run_id
      join public.payroll_periods period on period.id=r.period_id
      where s.profile_id=new.profile_id and r.status in ('finalized','paid')
        and period.period_end>=new.effective_from) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  return new;
end; $$;
create trigger payroll_compensation_finalized_guard before insert on public.payroll_compensation_versions
  for each row execute function public.payroll_effective_version_guard();
create trigger payroll_statutory_finalized_guard before insert on public.payroll_statutory_profile_versions
  for each row execute function public.payroll_effective_version_guard();
create trigger payroll_recurring_finalized_guard before insert on public.payroll_recurring_component_versions
  for each row execute function public.payroll_effective_version_guard();
revoke all on function public.payroll_effective_version_guard() from public,anon,authenticated;
